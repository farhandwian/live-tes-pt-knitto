import { Router, Request, Response } from "express";

import fs from "fs/promises";
import path from "path";
import Redis from "ioredis";

const router = Router();

interface OrderItem {
  id_product: number;
  name: string;
  price: number;
  qty: number;
}

interface Order {
  address: string;
  payment_type: string;
  items: OrderItem[];
}

interface OrderResponse {
  message: string;
  result: {
    order_number: string;
  };
}

const redis = new Redis({
  host: "localhost", // Alamat host Redis
  port: 6379, // Port Redis
  db: 0, // Database index, default adalah 0
});

// Fungsi untuk mendapatkan running number terbaru dengan mekanisme fallback
const getLatestRunningNumber = async (customerId: number): Promise<number> => {
  const today = new Date();
  const datePart = `${today.getDate().toString().padStart(2, "0")}${(
    today.getMonth() + 1
  )
    .toString()
    .padStart(2, "0")}${today.getFullYear().toString().slice(-2)}`;
  const redisKey = `order:${customerId}:${datePart}`;

  // Coba dapatkan nilai running number dari Redis
  let latestRunningNumber = await redis.get(redisKey);

  if (latestRunningNumber) {
    return parseInt(latestRunningNumber, 10);
  } else {
    // Jika Redis kosong, gunakan mekanisme fallback untuk membaca dari file
    return getLatestRunningNumberFromFiles(customerId, datePart);
  }
};

// Fungsi untuk membaca running number terbaru dari file jika Redis kosong
const getLatestRunningNumberFromFiles = async (
  customerId: number,
  datePart: string
): Promise<number> => {
  const directoryPath = path.join(__dirname, "/database/customer-order");

  let maxRunningNumber = 0;

  try {
    const files = await fs.readdir(directoryPath);

    files.forEach((file) => {
      const fileNamePattern = new RegExp(
        `ORDER-${customerId}-${datePart}-(\\d{5})\\.json`
      );
      const match = file.match(fileNamePattern);
      if (match) {
        const fileRunningNumber = parseInt(match[1], 10);
        if (fileRunningNumber > maxRunningNumber) {
          maxRunningNumber = fileRunningNumber;
        }
      }
    });
  } catch (error) {
    console.error("Error reading directory:", error);
    // Handle directory read error if necessary
  }

  return maxRunningNumber;
};

// Fungsi utama untuk menghasilkan nomor order yang unik
const generateUniqueOrderNumber = async (
  customerId: number
): Promise<string> => {
  const today = new Date();
  const datePart = `${today.getDate().toString().padStart(2, "0")}${(
    today.getMonth() + 1
  )
    .toString()
    .padStart(2, "0")}${today.getFullYear().toString().slice(-2)}`;
  const redisKey = `order:${customerId}:${datePart}`;

  // Ambil running number terbaru dengan fallback
  let runningNumber = await getLatestRunningNumber(customerId);

  // Tambahkan 1 ke running number untuk nomor order baru
  runningNumber += 1;

  // Simpan running number baru di Redis
  await redis.set(redisKey, runningNumber);

  // Format nomor order dengan running number yang baru
  const orderNumber = `ORDER-${customerId}-${datePart}-${runningNumber
    .toString()
    .padStart(5, "0")}`;
  return orderNumber;
};

// Contoh penggunaan

// const generateOrderNumber = async (customerId: number): Promise<string> => {
//   const today = new Date();
//   const datePart = `${today.getDate().toString().padStart(2, "0")}${(
//     today.getMonth() + 1
//   )
//     .toString()
//     .padStart(2, "0")}${today.getFullYear().toString().slice(-2)}`;
//   const redisKey = `order:${customerId}:${datePart}`;
//   const runningNumber = await redis.incr(redisKey);
//   const runningNumberPart = runningNumber.toString().padStart(5, "0");
//   return `ORDER-${customerId}-${datePart}-${runningNumberPart}`;
// };

const saveOrderToFile = async (
  orderData: any,
  orderNumber: string
): Promise<void> => {
  const folderPath = path.join(__dirname, "database/customer-order");
  const filePath = path.join(folderPath, `${orderNumber}.json`);

  try {
    await fs.mkdir(folderPath, { recursive: true });
    await fs.writeFile(filePath, JSON.stringify(orderData, null, 2), "utf8");
  } catch (error) {
    throw error;
  }
};

const createOrderObject = (orderNumber: string, reqBody: any) => {
  const { id_customer, name, email, address, payment_type, items } = reqBody;
  const total = items.reduce(
    (sum: number, item: any) => sum + item.price * item.qty,
    0
  );

  return {
    no_order: orderNumber,
    id_customer,
    name,
    email,
    address,
    payment_type,
    items,
    total,
    status: "Order Diterima",
  };
};

router.post("/orders", async (req: Request, res: Response) => {
  // const { id_customer, name, email, address, payment_type, items } = req.body;
  // console.log(req.body);
  // if (!id_customer || !name || !email || !address || !payment_type || !items) {
  //   return res.status(400).json({ error: "Incomplete order data" });
  // }

  try {
    const orderNumber = await generateUniqueOrderNumber(1);
    const orderData = createOrderObject(orderNumber, req.body);
    let attempts = 0;
    const maxRetries = 3;
    let isSaved = false;

    while (!isSaved && attempts < maxRetries) {
      try {
        await saveOrderToFile(orderData, orderNumber);
        isSaved = true;
      } catch (error: any) {
        attempts++;
        console.error(`Error saving order file (attempt ${attempts}):`, error);
        if (attempts >= maxRetries) {
          return res.status(500).json({
            error: "Failed to save order file after 3 attempts",
            details: error.message,
          });
        }
      }
    }

    const result = {
      message: "Order Berhasil Diproses",
      result: {
        orderNumber: orderNumber,
      },
    };

    res.status(201).json(result);
  } catch (error) {
    console.error("Error processing order", error);
    res.status(500).json({ error: "Error processing order" });
  }
});

export default router;
